import { Suspense } from "react";
import { ContactLookupDemoCard } from "@/components/home-demos";

export default function Home() {
  return (
    <div className="container mx-auto p-8 sm:p-20 space-y-12">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">Welcome to MPNext</h1>
        <p className="text-lg text-muted-foreground">Explore demos showcasing Ministry Platform integration capabilities</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/*
          The demo tiles are client components that read the MP profile
          UserProvider already loads, so this page stays synchronous and makes
          no Ministry Platform call of its own. `useUser()` suspends while that
          profile is in flight, so the boundary here is required — without it
          the suspension escapes to the route.
        */}
        <Suspense fallback={null}>
          <ContactLookupDemoCard />
        </Suspense>
      </div>
    </div>
  );
}
