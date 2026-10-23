"""Dependency-free policy tests, safe before sandbox claiming."""
import unittest
from app.core.session_cookie_policy import build_session_cookie_options

class SessionCookiePolicyTests(unittest.TestCase):
    def options(self, **overrides):
        args = {"name": "test-session", "ttl_seconds": 1200,
                "secure": False, "same_site": "lax"}
        args.update(overrides)
        return build_session_cookie_options(**args)

    def test_local_policy(self):
        options = self.options()
        self.assertEqual(options["max_age"], 1200)
        self.assertEqual(options["path"], "/")
        self.assertTrue(options["httponly"])
        self.assertFalse(options["secure"])
        self.assertEqual(options["samesite"], "lax")

    def test_secure_cross_site_policy(self):
        self.assertEqual(self.options(secure=True, same_site="none")["samesite"], "none")

    def test_none_requires_secure(self):
        with self.assertRaises(ValueError):
            self.options(same_site="none")

    def test_strict_and_case_normalization(self):
        self.assertEqual(self.options(same_site=" STRICT ")["samesite"], "strict")

    def test_invalid_names(self):
        for value in ["", " ", None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.options(name=value)

    def test_invalid_ttls(self):
        for value in [0, -1, True, "1200", None]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.options(ttl_seconds=value)

    def test_invalid_policies(self):
        for value in ["", "invalid", None, True]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.options(same_site=value)

    def test_secure_requires_boolean(self):
        with self.assertRaises(ValueError):
            self.options(secure="true")

if __name__ == "__main__":
    unittest.main()
