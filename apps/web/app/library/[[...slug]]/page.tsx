import { PublicPage } from '../../../src/components/public-page';
export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  return <PublicPage kind="library" libraryId={slug?.join('/')} />;
}
