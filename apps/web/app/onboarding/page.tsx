import { AccountApp } from '../../../../packages/ui/src/account';
export const dynamic = 'force-dynamic';
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  return <AccountApp mode="onboarding" next={query.next}/>;
}
