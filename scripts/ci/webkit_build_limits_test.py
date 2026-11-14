import unittest
from webkit_build_limits import compile_budget, stop_reason

class BuildBudgetTests(unittest.TestCase):
    def test_short_setup_preserves_full_compile_and_acceptance(self):
        self.assertEqual(compile_budget(120), 310 * 60)
        self.assertGreaterEqual(350 * 60 - 120 - compile_budget(120), 35 * 60)

    def test_long_setup_cannot_consume_acceptance_reserve(self):
        self.assertEqual(compile_budget(60 * 60), 255 * 60)
        with self.assertRaises(RuntimeError): compile_budget(290 * 60)
        with self.assertRaises(ValueError): compile_budget(-1)

    def test_progress_does_not_override_deadline_or_reserves(self):
        gib=1024**3
        self.assertIsNone(stop_reason(500,1000,3*gib,5*gib,0))
        self.assertIn('compile/link',stop_reason(1000,1000,3*gib,5*gib,0))
        self.assertIn('MemAvailable',stop_reason(1,1000,2*gib-1,5*gib,0))
        self.assertIn('disk',stop_reason(1,1000,3*gib,4*gib-1,0))
        self.assertIn('Ninja',stop_reason(2000,3000,3*gib,5*gib,1800))

if __name__=='__main__': unittest.main()
