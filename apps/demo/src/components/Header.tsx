export function Header() {
  return (
    <header className="header" data-testid="header">
      <span className="logo">Redline</span>
      <nav className="nav">
        <a href="#stats">Stats</a>
        <a href="#signup">Sign up</a>
      </nav>
    </header>
  );
}
