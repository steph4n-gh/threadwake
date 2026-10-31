"""Bounded system-check fixtures; no real process inspection or model load."""
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import brain


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.patches = [patch.object(brain.time, 'monotonic', return_value=100),
                        patch.object(brain, 'record'), patch.object(brain.os, 'getpid', return_value=1001),
                        patch.object(brain.os, 'getppid', return_value=1000)]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_each_system_command_timeout_yields_unknown(self):
        for failed in ('ps', 'lsof', 'memory_pressure'):
            with self.subTest(command=failed):
                guard = brain.Guard()
                guard.last_cpu[2000] = 0
                guard.last_poll = 99
                def result(command, **kwargs):
                    self.assertEqual(kwargs['timeout'], 3)
                    name = Path(command[0]).name
                    if name == failed:
                        raise subprocess.TimeoutExpired(command, kwargs['timeout'])
                    return {'ps': '2000 1 00:01.0 100000 Python\n',
                            'lsof': 'p2000\nn/lib/mlx/core.so\n',
                            'memory_pressure': 'System-wide memory free percentage: 55%'}[name]
                with patch.object(brain.subprocess, 'check_output', side_effect=result):
                    with self.assertRaisesRegex(brain.Busy, f'timed out \\({failed}\\).*unknown'):
                        guard.check(force=True)
                self.assertEqual(guard.quiet_until, 120)
                self.assertEqual(brain.record.call_args.args[1]['reason'], 'check_timeout')

    def test_command_failure_yields_unknown(self):
        for error in (OSError('unavailable'), subprocess.CalledProcessError(1, ['ps'])):
            with self.subTest(error=type(error).__name__):
                with patch.object(brain.subprocess, 'check_output', side_effect=error):
                    with self.assertRaisesRegex(brain.Busy, r'failed \(ps\).*unknown'):
                        brain.Guard().check(force=True)

    def test_low_memory_reason_and_threshold_are_exact(self):
        for percent in (19, 20):
            with self.subTest(percent=percent):
                guard = brain.Guard()
                with patch.object(brain.subprocess, 'check_output', side_effect=['', f'System-wide memory free percentage: {percent}%']):
                    if percent < 20:
                        with self.assertRaisesRegex(brain.Busy, r'19% memory free \(minimum 20%\)') as result:
                            guard.check(force=True)
                        self.assertNotIn('Other MLX', str(result.exception))
                        self.assertEqual(brain.record.call_args.args[1]['reason'], 'low_memory')
                    else:
                        guard.check(force=True)

    def test_own_worker_and_parent_cannot_cause_contention(self):
        guard = brain.Guard()
        guard.last_cpu = {1001: 0, 1000: 0}
        guard.last_poll = 99
        listing = '1001 1000 00:20.0 100000 Python\n1000 1 00:20.0 100000 Python\n'
        with patch.object(brain.subprocess, 'check_output', side_effect=[listing, 'System-wide memory free percentage: 55%']) as check:
            guard.check(force=True)
        self.assertEqual([Path(call.args[0][0]).name for call in check.call_args_list], ['ps', 'memory_pressure'])

    def test_contention_reports_observed_pid_without_naming_a_model(self):
        guard = brain.Guard()
        guard.last_cpu[2000] = 0
        guard.last_poll = 99
        with patch.object(brain.subprocess, 'check_output', side_effect=[
                '2000 1 00:01.0 100000 Python\n', 'p2000\nn/lib/mlx/core.so\n',
                'System-wide memory free percentage: 55%']):
            with self.assertRaisesRegex(brain.Busy, r'MLX Python activity detected \(PIDs: 2000\)'):
                guard.check(force=True)
        self.assertEqual(brain.record.call_args.args[1]['other_active_pids'], [2000])

    def test_unreadable_memory_does_not_reuse_optimistic_default(self):
        with patch.object(brain.subprocess, 'check_output', side_effect=['', 'unrecognized output']):
            with self.assertRaisesRegex(brain.Busy, 'memory check returned unreadable data'):
                brain.Guard().check(force=True)


if __name__ == '__main__':
    unittest.main()
