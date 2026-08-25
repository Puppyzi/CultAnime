'use client';

import { useEffect } from 'react';
import { ErrorState } from '../components/Feedback';

export default function AppError({ error, retry }) {
  useEffect(() => { console.error(error); }, [error]);
  return <ErrorState title="CultAnime hit an unexpected error" message="Your data is safe. Retry the page, and check the server logs if this keeps happening." onRetry={retry} />;
}
