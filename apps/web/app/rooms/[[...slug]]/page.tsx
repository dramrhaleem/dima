import { PublicPage } from '../../../src/components/public-page';
export default async function Page({ params, searchParams }: { params: Promise<{ slug?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams(Object.entries(search).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : [])).toString();
  return <PublicPage kind="rooms" roomId={slug?.join('/')} query={query}/>;
}
