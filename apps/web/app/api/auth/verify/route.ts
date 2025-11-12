import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Check for the session cookie
    const sessionCookie = request.cookies.get('rnd-ai-auth-session');

    if (sessionCookie && sessionCookie.value === 'authenticated') {
      return NextResponse.json({
        authenticated: true,
        user: {
          email: process.env.ADMIN_EMAIL || 'admin@admin.com',
          name: 'Administrator',
          role: 'admin'
        }
      });
    }

    return NextResponse.json(
      { authenticated: false },
      { status: 401 }
    );
  } catch (error) {
    console.error('Auth verification error:', error);
    return NextResponse.json(
      { authenticated: false },
      { status: 500 }
    );
  }
}
