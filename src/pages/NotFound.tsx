import { NotFoundView } from "../components/NotFoundView";
import { useTitle } from "../lib/meta";

export default function NotFound() {
  useTitle("Page not found");
  return <NotFoundView />;
}
