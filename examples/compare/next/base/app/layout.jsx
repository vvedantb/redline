import './globals.css';
import Nav from '../components/Nav';

export const metadata = { title: 'Acme' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
