import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/admin')({
  beforeLoad: () => {
    throw notFound();
  },
});
