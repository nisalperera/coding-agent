'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { handleGitLabCallback } from '../../../lib/integrations';

export default function GitLabCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const result = await handleGitLabCallback();
      if (result?.message) {
        sessionStorage.setItem('pending_integration_message', result.message);
      }
      router.replace('/');
    })();
  }, [router]);

  return (
    <div className="h-screen flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
      Connecting GitLab...
    </div>
  );
}
