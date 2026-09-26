import { useState, type FormEvent } from 'react';

export function Signup() {
  const [sent, setSent] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSent(true);
  };
  return (
    <section id="signup" className="signup" data-testid="signup">
      <h2>Get updates</h2>
      <form onSubmit={submit} className="signup-form">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" placeholder="you@example.com" required />
        <button type="submit" className="cta">
          {sent ? 'Thanks' : 'Notify me'}
        </button>
      </form>
    </section>
  );
}
