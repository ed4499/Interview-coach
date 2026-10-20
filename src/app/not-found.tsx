import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card empty">
      <h1>Not found</h1>
      <p className="muted">This interview doesn&apos;t exist or belongs to another account.</p>
      <Link href="/" className="btn">
        Back to dashboard
      </Link>
    </div>
  );
}
