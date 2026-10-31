"""Text-only Gemma 4 adapter for the pinned public MLX-LM release.

The residual projection follows MLX-LM v0.32.2's public gemma4_text.Model
norm -> tied embedding/head -> softcap path. No model weights are modified.
"""
from __future__ import annotations

import platform

import model_config


class LocalModel:
    def __init__(self, variant, check_idle):
        if platform.system() != 'Darwin' or platform.machine() != 'arm64':
            raise RuntimeError('Local inference currently requires Apple Silicon macOS.')
        path = model_config.verify_model(variant)
        import mlx.core as mx
        from mlx_lm import load
        self.mx = mx
        check_idle()
        self.model, self.tokenizer = load(
            str(path), lazy=False, trust_remote_code=False,
            tokenizer_config={'local_files_only': True, 'trust_remote_code': False},
        )
        if self.model.model_type != 'gemma4':
            raise ValueError('Only the manifest-pinned Gemma 4 architecture is supported.')
        self.text_model = self.model.language_model
        self.layers = self.model.layers
        self.num_layers = len(self.layers)

    def format_prompt(self, prompt, *, system=None, enable_thinking=False):
        messages = []
        if system:
            messages.append({'role': 'system', 'content': system})
        messages.append({'role': 'user', 'content': prompt})
        return self.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True, enable_thinking=enable_thinking,
        )

    def encode_rendered(self, rendered):
        # The chat template already supplies the model's special tokens.
        return self.tokenizer.encode(rendered, add_special_tokens=False)

    def forward_logits(self, ids):
        return self.model(self.mx.array([ids]))

    def project_last_token_logits(self, residual):
        text = self.text_model
        hidden = text.model.norm(residual)
        logits = text.model.embed_tokens.as_linear(hidden) if text.tie_word_embeddings else text.lm_head(hidden)
        cap = text.final_logit_softcapping
        if cap is not None:
            logits = self.mx.tanh(logits / cap) * cap
        return logits[0, -1, :]

    def stream_text(self, prompt, *, max_tokens, temp, seed, system=None, enable_thinking=False):
        if not 1 <= max_tokens <= 1024:
            raise ValueError('Generation must have a bounded token budget of at most 1024.')
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_sampler
        self.mx.random.seed(seed)
        tokens = self.encode_rendered(self.format_prompt(prompt, system=system, enable_thinking=enable_thinking))
        generation = stream_generate(self.model, self.tokenizer, tokens, max_tokens=max_tokens, sampler=make_sampler(temp=temp))
        try:
            for result in generation:
                yield result.text
        finally:
            generation.close()

    def close(self):
        self.layers = []
        self.text_model = None
        self.model = None
        self.tokenizer = None
