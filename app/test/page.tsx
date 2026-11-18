import Dashboard from "../dashboard-v2/Dashboard";
import { DashboardPageProvider } from "../dashboard-v2/DashboardPageProvider";

export default function LocalTestPage() {
  return <DashboardPageProvider mode="local-test"><Dashboard basePath="/test" /></DashboardPageProvider>;
}
