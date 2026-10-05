export default function Button({ children }) {
  return (
    <button style={{ padding: '14px 28px', borderRadius: 999, border: 0, background: '#16a34a', color: '#fff', fontSize: 17 }}>
      {children}
    </button>
  );
}
