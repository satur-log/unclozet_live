import { DashboardPageProvider } from "@/app/dashboard-v2/DashboardPageProvider";

// 방송 내역·고객 관리가 같은 Provider를 공유한다. 화면을 옮겨 다녀도 다시 불러오지 않고, 저장 대기 중인 변경도 유지된다.
// 고객 화면(/pants → /test/gb/…)과 공구 관리(/group-buys)는 이 그룹 밖이라 Provider가 실행되지 않는다.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardPageProvider>{children}</DashboardPageProvider>;
}
