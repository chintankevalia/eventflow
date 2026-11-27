import { SkeletonPage, SkeletonText, SkeletonHeader } from "@/components/ui/skeleton";

/**
 * The fallback for every portal page that has no skeleton of its own — settings, templates,
 * account and the rest. A generic page shape is better than a frozen screen: the click is seen to
 * have done something the instant it lands. Pages with a distinctive layout keep their own.
 */
export default function Loading() {
  return (
    <SkeletonPage label="Loading">
      <div className="mx-auto w-full max-w-5xl">
        <SkeletonHeader />
        <SkeletonText lines={6} />
      </div>
    </SkeletonPage>
  );
}
