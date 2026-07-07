import DashboardClient, { type DashboardData } from './dashboard-client';
import data from './generated/data.json';

// Server component: load the build-time snapshot and hand it to the interactive
// client shell (which owns theme + replay-selection state).
export default function Page() {
  return <DashboardClient data={data as unknown as DashboardData} />;
}
