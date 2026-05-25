import RequestClient from './RequestClient';

export default async function RequestPage({ searchParams }) {
  const params = await searchParams;
  const initialQuery = typeof params?.q === 'string' ? params.q : '';

  return <RequestClient initialQuery={initialQuery} />;
}
