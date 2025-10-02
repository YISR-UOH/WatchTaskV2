export default function Footer() {
  return (
    <footer className="bg-white shadow-inner mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 text-center text-sm text-gray-500">
        &copy; {new Date().getFullYear()} WatchTask. v0.0.1.7 Debug State
      </div>
    </footer>
  );
}
