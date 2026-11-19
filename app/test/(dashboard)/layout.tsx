import { DashboardPageProvider } from "@/app/dashboard-v2/DashboardPageProvider";

// /test 대시보드: 이 브라우저에만 저장하는 연습용 작업공간. 고객 공구 화면(/test/gb)은 이 그룹 밖이다.
export default function LocalTestDashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardPageProvider mode="local-test">{children}</DashboardPageProvider>;
}
