import { useEffect, useRef } from 'react';

const GOOGLE_SCRIPT_ID = 'google-identity-services-script';

function loadGoogleIdentityScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Window is not available'));
      return;
    }

    if (window.google?.accounts?.id) {
      resolve(window.google);
      return;
    }

    const existingScript = document.getElementById(GOOGLE_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google script')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_SCRIPT_ID;
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Failed to load Google script'));
    document.head.appendChild(script);
  });
}

export default function GoogleSignInButton({
  clientId,
  onToken,
  onError,
  buttonText = 'continue_with',
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!clientId) return undefined;

    let isDisposed = false;

    loadGoogleIdentityScript()
      .then(() => {
        if (isDisposed) return;
        if (!window.google?.accounts?.id || !containerRef.current) {
          onError?.('Google Sign-In is temporarily unavailable.');
          return;
        }

        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: (response) => {
            if (!response?.credential) {
              onError?.('Google Sign-In failed. Please try again.');
              return;
            }
            onToken?.(response.credential);
          },
        });

        containerRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: buttonText,
          width: containerRef.current.clientWidth || 320,
        });
      })
      .catch(() => {
        if (!isDisposed) {
          onError?.('Unable to load Google Sign-In. Please try again later.');
        }
      });

    return () => {
      isDisposed = true;
    };
  }, [buttonText, clientId, onError, onToken]);

  return <div ref={containerRef} className="w-full min-h-[40px] flex justify-center" />;
}
