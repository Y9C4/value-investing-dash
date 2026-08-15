import { redirect } from "next/navigation"

export default function Home() {
  // Screening is the entry point to the workflow — value first, then optimise.
  redirect("/screener")
}
