"""CPU-only request and worker-protocol contract. No model is loaded."""
import json
from pathlib import Path
import subprocess
import sys

import brain

ROOT = Path(__file__).resolve().parent


def run():
    context = {'board': 'archive', 'stage': 0, 'target': 2, 'nodes': [0, 1, 3], 'strain': 0, 'revision': 1}
    request = {'id': 'valid-boundary', 'relay': 2, 'scope': 'broad', 'strength': 1,
               'bias': 'BRIDGE', 'request': 'A public CPU fixture.', 'context': context}
    validated = brain.validate(request)
    assert validated == request
    validated['context']['nodes'][0] = 3
    assert context['nodes'] == [0, 1, 3]
    for patch in ({'relay': True}, {'scope': 'foreign'}, {'strength': float('inf')},
                  {'strength': True}, {'bias': 'UNKNOWN'}, {'request': 'x' * 281}):
        try:
            brain.validate({**request, **patch})
        except ValueError:
            pass
        else:
            raise AssertionError(f'Invalid request accepted: {patch}')

    # Every line is invalid before model loading; a later reply proves recovery.
    lines = [
        json.dumps({'id': 'invalid-relay', 'relay': 7}),
        json.dumps({'id': 'invalid-strength', 'strength': float('nan')}),
        '{"id":"duplicate","id":"other"}',
        json.dumps({'id': 'unknown-kind', 'kind': 'execute_python'}),
        json.dumps({'id': 'invalid-scope', 'scope': 'foreign'}),
        json.dumps({'op': 'close'}),
    ]
    result = subprocess.run([sys.executable, '-B', str(ROOT / 'brain.py')],
                            input='\n'.join(lines) + '\n', capture_output=True,
                            text=True, timeout=15, cwd=ROOT)
    assert result.returncode == 0, result.stderr
    responses = [json.loads(line) for line in result.stdout.splitlines()]
    assert [row['id'] for row in responses] == ['invalid-relay', None, None, 'unknown-kind', 'invalid-scope']
    assert all(row['status'] == 'error' and row['error'] == 'invalid' for row in responses)
    assert 'mlx.core' not in sys.modules
    print(json.dumps({'pass': True, 'scope': 'CPU validation and invalid-line protocol recovery only',
                      'invalid_protocol_cases': len(responses), 'new_inference_started': False}, indent=2))


if __name__ == '__main__':
    run()
