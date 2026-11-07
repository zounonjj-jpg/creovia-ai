import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'CREOVIA AI — Creative Studio', description: 'Create cinematic videos and visuals with AI.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
