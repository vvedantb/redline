import Link from 'next/link';

export default function Nav() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/blog/hello">Blog</Link>
      <Link href="/contact">Contact</Link>
      <Link href="/status">Status</Link>
      <Link href="/account">Account</Link>
    </nav>
  );
}
