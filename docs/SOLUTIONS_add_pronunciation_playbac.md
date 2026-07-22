// Check if 'document' is defined (i.e., if we are running in a browser environment) 
// before trying to use DOM methods like addEventListener.
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        // [Your original script logic goes here]
        // Example: console.log("Document loaded successfully.");
    });
} else {
    // Optional: Handle the case where the code is run in a non-browser environment (like Node.js)
    console.log("Running outside a browser environment. DOM manipulation skipped.");
}

// Note: If your script needs to execute logic that doesn't rely on the DOM, 
// place that logic OUTSIDE of the 'document.addEventListener' block.