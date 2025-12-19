# Google SSO Setup Guide

This guide explains how to set up and run the Live Grading Assistant with Google Single Sign-On (SSO) authentication.

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)
- Google Cloud Project with OAuth 2.0 credentials
- Airtable account with teacher data

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

This will install:
- express
- express-session
- google-auth-library
- cors
- dotenv

### 2. Configure Google OAuth Credentials

The `credentials.json` file is already configured with your Google OAuth credentials. **Important**: This file contains sensitive information and is excluded from git via `.gitignore`.

**Note**: You need to add `http://localhost:3000/auth/callback` to your authorized redirect URIs in the Google Cloud Console:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: `gen-lang-client-0306683066`
3. Navigate to **APIs & Services > Credentials**
4. Edit your OAuth 2.0 Client ID
5. Add `http://localhost:3000/auth/callback` to **Authorized redirect URIs**
6. Save changes

### 3. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The server will start on `http://localhost:3000`

### 4. Access the Application

1. Open your browser and navigate to: `http://localhost:3000/index.html`
2. You'll see the login screen with "Sign in with Google" button
3. Click the button to authenticate with your Google account
4. After successful authentication, you'll be automatically logged in and redirected to the sections screen

## How It Works

### Authentication Flow

1. **Login Screen**: User clicks "Sign in with Google"
2. **OAuth Redirect**: User is redirected to Google's OAuth consent screen
3. **Authorization**: User authorizes the application
4. **Callback**: Google redirects back to `/auth/callback` with authorization code
5. **Token Exchange**: Server exchanges code for access token and ID token
6. **Email Verification**: Server verifies the user's email from the ID token
7. **Teacher Lookup**: System looks up teacher in Airtable by email
8. **Auto-Selection**: Teacher is automatically selected and redirected to sections screen

### API Endpoints

- `GET /auth/google` - Initiates Google OAuth flow
- `GET /auth/callback` - Handles OAuth callback and creates session
- `GET /auth/status` - Checks current authentication status
- `POST /auth/logout` - Destroys session and logs out user

### Security Features

- Session-based authentication using `express-session`
- OAuth 2.0 with ID token verification
- Client secret stored server-side only (not exposed to frontend)
- Automatic teacher verification against Airtable
- Session expiration (24 hours)

## Teacher Management

### Adding Teachers to Airtable

For a teacher to be able to log in:

1. The teacher must exist in the Airtable "Teachers" table
2. The teacher's email in Airtable must match their Google account email
3. The teacher must have at least one section linked in Airtable

### Teacher Email Validation

When a user signs in with Google:
- The system retrieves their email from Google
- It searches for a matching email in the Airtable Teachers table
- If found, the teacher is auto-selected
- If not found, an error message is displayed

## Troubleshooting

### "No teacher found with email" Error

This means the logged-in Google account email doesn't match any teacher in Airtable:
- Verify the teacher exists in Airtable
- Check that the email in Airtable matches exactly (case-insensitive)
- Ensure the teacher has the Email field populated

### "Failed to load sections" Error

This indicates the teacher has no sections linked:
- Check the teacher's record in Airtable
- Ensure the "Master Sections" field has at least one linked section

### OAuth Redirect URI Mismatch

If you see a redirect URI mismatch error:
- Verify `http://localhost:3000/auth/callback` is in your Google Cloud Console authorized redirect URIs
- Make sure the URL is exactly correct (no trailing slash)
- Wait a few minutes for Google's changes to propagate

### Port Already in Use

If port 3000 is already in use:
1. Stop any other process using port 3000
2. Or modify `server.js` to use a different port
3. Update the redirect URI in both `credentials.json` and Google Cloud Console

## Development Notes

### File Structure

- `server.js` - Express server with OAuth endpoints
- `credentials.json` - Google OAuth credentials (excluded from git)
- `index.html` - Frontend React application with login UI
- `package.json` - Node.js dependencies

### Session Management

Sessions are stored in memory by default. For production:
- Consider using a session store (Redis, MongoDB, etc.)
- Update the session secret in `server.js`
- Enable secure cookies if using HTTPS

### Extending Authentication

To add additional OAuth scopes:
1. Update the `scope` array in `server.js` (line 30)
2. Request user consent again
3. Access additional user data from the `payload` object

## Production Deployment

Before deploying to production:

1. **Use HTTPS**: Enable secure cookies in session config
2. **Session Store**: Use Redis or another persistent session store
3. **Environment Variables**: Move sensitive config to environment variables
4. **Update Redirect URIs**: Add production URLs to Google Cloud Console
5. **Session Secret**: Generate a strong random session secret
6. **Error Handling**: Add comprehensive error logging and monitoring

## Support

For issues related to:
- **Google OAuth**: Check [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- **Airtable Integration**: Verify API keys and table structure
- **Application Bugs**: Check browser console and server logs
