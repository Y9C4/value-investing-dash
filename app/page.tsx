import { redirect } from "next/navigation"

/**
 * There is no front door, on purpose.
 *
 * The app is a three-step workflow — screen, analyse, optimise — and a landing
 * page in front of it is a page the visitor has to leave before anything can
 * happen. The screener already states what it is in its own header, and the
 * market context strip above it carries the as-of state, so the explanatory
 * work a landing page was doing is done in place by the surface that needed it.
 *
 * Kept as a redirect rather than deleted: `/` is what gets pasted into a
 * message, and the share card in `opengraph-image.tsx` still hangs off this
 * route's metadata.
 */
export default function Home() {
  redirect("/screener")
}
