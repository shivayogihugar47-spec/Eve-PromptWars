import Link from "next/link";
import { Diya } from "@/components/diya/Diya";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#F4F6F8] flex flex-col items-center justify-center gap-5 px-6 text-center">
      <Diya size={160} moodOverride="worried" />
      <div>
        <h1 className="text-4xl font-extrabold text-[#111827] font-display">404</h1>
        <p className="text-sm font-bold text-[#374151] mt-2">
          Even Diya couldn&apos;t find this page.
        </p>
        <p className="text-sm text-[#66736A] mt-1">
          I checked under the mandap, behind the DJ and inside the laddoo box. Nothing.
        </p>
      </div>
      <Link
        href="/"
        className="mt-2 px-6 py-3 rounded-2xl bg-[#6366F1] text-white text-sm font-bold hover:bg-[#4F46E5] transition-colors"
      >
        Take me home
      </Link>
    </div>
  );
}
