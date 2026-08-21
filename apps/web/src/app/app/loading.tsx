export default function Loading() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12" aria-busy="true">
      <div className="h-10 w-40 max-w-full bg-sand-light rounded-lg animate-pulse mb-4" />
      <div className="h-5 w-full max-w-xs bg-sand-light rounded-lg animate-pulse mb-10" />
      <div className="bg-white rounded-2xl shadow-sm border border-sand-light p-5 sm:p-8">
        <div className="h-8 w-full max-w-[16rem] bg-sand-light rounded-lg animate-pulse mb-3" />
        <div className="h-5 w-full max-w-sm bg-sand-light rounded-lg animate-pulse mb-6" />
        <div className="h-12 w-full max-w-md bg-sand-light rounded-xl animate-pulse" />
      </div>
    </div>
  );
}
