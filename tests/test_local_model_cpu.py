"""Optional MLX tests on tiny synthetic CPU models, never downloaded weights.

Run after installing the local-model extra. These checks qualify adapter math
and cleanup, not the public checkpoints' game behavior or GPU performance.
"""
from pathlib import Path
import importlib.util
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if any(importlib.util.find_spec(name) is None for name in ('mlx', 'mlx_lm')):
    raise unittest.SkipTest('Optional CPU adapter checks require the local-model extra.')
import mlx.core as mx
mx.set_default_device(mx.cpu)
import mlx.nn as nn
from mlx_lm.models.gemma4 import Model, ModelArgs
from mlx.utils import tree_flatten
import brain
from local_model import LocalModel


def tiny_model(tied=True, quantized=False):
    mx.random.seed(41)
    model = Model(ModelArgs(vocab_size=64, text_config={
        'hidden_size': 32, 'intermediate_size': 64, 'num_hidden_layers': 4,
        'num_attention_heads': 2, 'num_key_value_heads': 1, 'head_dim': 16, 'global_head_dim': 16,
        'hidden_size_per_layer_input': 32, 'vocab_size_per_layer_input': 64, 'num_kv_shared_layers': 2,
        'sliding_window': 8, 'layer_types': ['sliding_attention', 'full_attention'] * 2,
        'tie_word_embeddings': tied,
    }))
    if quantized:
        nn.quantize(model, group_size=32, bits=4)
    session = LocalModel.__new__(LocalModel)
    session.mx, session.model = mx, model
    session.text_model, session.layers, session.num_layers = model.language_model, model.layers, 4
    session.tokenizer = SimpleNamespace(encode=lambda text, **kwargs: [1, 2, 3])
    instance = brain.Brain()
    instance.session, instance.mx, instance.nn = session, mx, nn
    instance.layer_index, instance.token_ids = 3, [4, 5, 6]
    instance.guard = SimpleNamespace(check=lambda **kwargs: None)
    return instance


class AdapterTests(unittest.TestCase):
    def test_load_checks_hashes_and_idle_before_public_loader(self):
        instance = tiny_model()
        order = []
        def verify(variant):
            self.assertEqual(variant, 'e2b')
            order.append('hashes')
            return Path('/synthetic-no-weights')
        def loader(path, **kwargs):
            self.assertEqual(order, ['hashes', 'idle'])
            self.assertEqual(path, '/synthetic-no-weights')
            self.assertFalse(kwargs['trust_remote_code'])
            self.assertTrue(kwargs['tokenizer_config']['local_files_only'])
            return instance.session.model, instance.session.tokenizer
        with patch('model_config.verify_model', verify), patch('mlx_lm.load', loader):
            loaded = LocalModel('e2b', lambda: order.append('idle'))
        self.assertEqual(loaded.num_layers, 4)

    def test_projection_matches_actual_model_head_and_gradient(self):
        for tied, quantized in ((True, False), (False, False), (True, True), (False, True)):
            with self.subTest(tied=tied, quantized=quantized):
                instance = tiny_model(tied, quantized)
                weights = [(name, value.tolist()) for name, value in tree_flatten(instance.session.model.parameters())]
                before, captured = instance.forward('fixture')
                projected = instance.session.project_last_token_logits(captured['last'])
                actual = instance.session.forward_logits([1, 2, 3])[0, -1, :]
                self.assertLess(float(mx.max(mx.abs(actual - projected)).item()), 1e-6)
                objective = lambda h: instance.session.project_last_token_logits(h)[6]
                gradient = mx.grad(objective)(captured['last'])
                direction = gradient / mx.linalg.norm(gradient)
                original = instance.session.layers[-1]
                edited, measurement = instance.forward('fixture', direction, .25, 'focused')
                self.assertIs(instance.session.layers[-1], original)
                self.assertGreater(measurement['edit']['changed_elements'], 0)
                self.assertEqual(measurement['edit']['edited_tokens'], 1)
                self.assertNotEqual(before, edited)
                restored, _ = instance.forward('fixture')
                self.assertEqual(before, restored)
                _, broad = instance.forward('fixture', direction, .25, 'broad')
                self.assertEqual(broad['edit']['edited_tokens'], 3)
                self.assertGreater(broad['edit']['changed_elements'], measurement['edit']['changed_elements'])
                self.assertEqual(weights, [(name, value.tolist()) for name, value in tree_flatten(instance.session.model.parameters())])

    def test_wrapper_restores_on_model_exception(self):
        instance = tiny_model()
        original = instance.session.layers[-1]
        forward = instance.session.forward_logits
        def fail_after_forward(ids):
            forward(ids)
            raise RuntimeError('injected forward failure')
        with patch.object(instance.session, 'forward_logits', fail_after_forward):
            with self.assertRaisesRegex(RuntimeError, 'injected forward'):
                instance.forward('fixture')
        self.assertIs(instance.session.layers[-1], original)
        instance.forward('fixture')

    def test_wrapper_restores_on_busy_guard(self):
        instance = tiny_model()
        original = instance.session.layers[-1]
        with patch.object(instance.guard, 'check', side_effect=brain.Busy('injected contention')):
            with self.assertRaises(brain.Busy):
                instance.forward('fixture')
        self.assertIs(instance.session.layers[-1], original)

    def test_generation_is_bounded_and_closed(self):
        instance = tiny_model()
        closed = []
        def fake_generation(*args, **kwargs):
            self.assertEqual(kwargs['max_tokens'], 4)
            try:
                yield SimpleNamespace(text='fixture')
                yield SimpleNamespace(text='not consumed')
            finally:
                closed.append(True)
        with patch('mlx_lm.stream_generate', fake_generation), patch.object(instance.session, 'format_prompt', return_value='fixture'):
            stream = instance.session.stream_text('fixture', max_tokens=4, temp=0, seed=1)
            self.assertEqual(next(stream), 'fixture')
            stream.close()
            self.assertEqual(closed, [True])
        for budget in (0, -1, 1025):
            with self.assertRaises(ValueError):
                next(instance.session.stream_text('fixture', max_tokens=budget, temp=0, seed=1))


if __name__ == '__main__':
    unittest.main()
