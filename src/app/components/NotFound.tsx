import { Link } from "react-router";

export function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-6 py-16">
      <div className="text-center">
        <h1 className="display text-[clamp(120px,30vw,300px)] leading-none mb-2">404</h1>
        <p className="hand mb-6">Page not found</p>
        <p className="text-b60 mb-10">The page you're looking for doesn't exist.</p>
        <Link to="/" className="cta">Go home</Link>
      </div>
    </div>
  );
}
