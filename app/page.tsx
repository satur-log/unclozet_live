import Dashboard from "./dashboard-v2/Dashboard";
import { DashboardPageProvider } from "./dashboard-v2/DashboardPageProvider";
export default function Home() { return <DashboardPageProvider><Dashboard /></DashboardPageProvider>; }
