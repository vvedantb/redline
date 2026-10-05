export default function ContactForm() {
  return (
    <form>
      <label htmlFor="email">Email</label>
      <input id="email" type="email" />
      <label htmlFor="message">Message</label>
      <textarea id="message" rows={4} />
      <p>
        <button className="button" type="button">Send</button>
      </p>
    </form>
  );
}
