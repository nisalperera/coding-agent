'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  isSignedIn,
  getCachedUser,
  loginWithGoogle,
  logout as logoutRequest,
  completeLoginFromUrlFragment,
  refreshCurrentUser,
} from '../lib/auth';

export function useAuth() {
  const [signedIn, setSignedIn] = useState(false);
  const [user, setUser] = useState(null);

  const refresh = useCallback(() => {
    setSignedIn(isSignedIn());
    setUser(getCachedUser());
  }, []);

  useEffect(() => {
    (async () => {
      await completeLoginFromUrlFragment();
      await refreshCurrentUser();
      refresh();
    })();
  }, [refresh]);

  const logout = useCallback(async () => {
    await logoutRequest();
    refresh();
  }, [refresh]);

  return { signedIn, user, loginWithGoogle, logout, refresh };
}
