import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState } from "../components/page";
import { Button } from "../components/ui/button";
import { useSearch } from "../components/layout/Search";
import { useTitle } from "../lib/meta";

export default function NotFound() {
  useTitle("Not found");
  const { open } = useSearch();
  return (
    <EmptyState icon={Compass} title="This page doesn't exist" description="The link may be old, or the team or event number mistyped."
      action={<div className="flex gap-2"><Button onClick={open}>Search</Button><Button variant="secondary" asChild><Link to="/">Home</Link></Button></div>} />
  );
}
