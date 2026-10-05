import { Link } from 'react-router-dom';

export default function Layout({ children }) {
  return (
    <>
      <nav>
        <Link to="/">Home</Link>
        <Link to="/about">About</Link>
        <Link to="/contact">Contact</Link>
      </nav>
      <main>{children}</main>
    </>
  );
}
