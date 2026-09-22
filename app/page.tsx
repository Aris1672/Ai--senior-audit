import { redirect } from "next/navigation";

// Root page was the unedited create-next-app scaffold — never replaced
// since project creation. Redirect straight to the real entry point.
export default function Home() {
  redirect("/login");
}
