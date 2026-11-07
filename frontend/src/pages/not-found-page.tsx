import { Link } from 'react-router-dom';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';

export function NotFoundPage() {
  return (
    <Card className="mx-auto max-w-md p-10 text-center">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold">This page does not exist</h1>
      <p className="mt-2 text-sm text-muted-foreground">The link may be outdated, or the record was removed.</p>
      <Link to="/" className="mt-6 inline-block">
        <Button>Back to overview</Button>
      </Link>
    </Card>
  );
}
