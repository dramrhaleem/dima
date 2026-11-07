import { PublicProfileCard } from '../../../../../packages/ui/src/profile-settings';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{handle: string}> }) {
 const {handle} = await params;
 return <PublicProfileCard handle={handle}/>;
}
