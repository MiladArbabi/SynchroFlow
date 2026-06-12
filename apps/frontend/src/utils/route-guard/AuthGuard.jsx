import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';

// project imports
import useAuth from 'hooks/useAuth';
import { useEffect } from 'react';

// ==============================|| AUTH GUARD ||============================== //

/**
 * Authentication guard for routes
 * @param {PropTypes.node} children children element/node
 */
export default function AuthGuard({ children }) {
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn) {
      /**
       * ABSOLUTE PATH (critical)
       * ─────────────────────────
       * Must be '/login' not 'login' — relative navigation would produce
       * /some/nested/login instead of the root /login route.
       */
      navigate('/login', { replace: true });
    }
  }, [isLoggedIn, navigate]);

  return children;
}

AuthGuard.propTypes = { children: PropTypes.any };
