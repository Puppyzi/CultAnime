import { redirect } from 'next/navigation';

export default function LegacyIndexRedirect() {
  redirect('/anime-index');
}
