<a href="https://newfold.com/" target="_blank">
    <img src="https://newfold.com/content/experience-fragments/newfold/site-header/master/_jcr_content/root/header/logo.coreimg.svg/1621395071423/newfold-digital.svg" alt="Newfold Logo" title="Newfold Digital" align="right" 
height="42" />
</a>

# WordPress AI Editor Chat Module

[![Version Number](https://img.shields.io/github/v/release/newfold-labs/wp-module-editor-chat?color=21a0ed&labelColor=333333)](https://github.com/newfold-labs/wp-module-editor-chat/releases)
[![License](https://img.shields.io/github/license/newfold-labs/wp-module-editor-chat?labelColor=333333&color=666666)](https://raw.githubusercontent.com/newfold-labs/wp-module-editor-chat/master/LICENSE)

AI-powered editor assistant for WordPress sites. This module integrates an intelligent AI agent directly into the WordPress site editor, enabling users to update pages and control styles through natural language conversations.

## Module Responsibilities

- **AI Chat Interface**: Provides a conversational AI assistant accessible from the WordPress site editor
- **Content Generation**: Enables users to create, edit, and update page content using natural language prompts
- **Style Control**: Allows AI-powered manipulation of colors, typography, spacing, and other design elements
- **Real-time Editing**: Integrates seamlessly with the WordPress block editor for live content updates
- **Design Suggestions**: Offers intelligent recommendations for improving page design and user experience
- **Template Assistance**: Helps users create and customize page templates with AI guidance
- **Multi-language Support**: Provides AI assistance in multiple languages for global users

## Key Features

### **Intelligent Content Creation**

- Generate page content from simple prompts
- Rewrite and optimize existing content
- Create compelling headlines and call-to-action text
- Generate product descriptions and marketing copy

### **AI-Powered Style Control**

- **Color Management**: Change color schemes, palettes, and individual element colors
- **Typography Control**: Adjust fonts, sizes, weights, and text styling
- **Layout Optimization**: Modify spacing, alignment, and responsive behavior
- **Visual Enhancement**: Apply filters, effects, and design improvements

### **Natural Language Interface**

- Conversational AI that understands context and intent
- Contextual suggestions based on current page content

### **Advanced Editor Integration**

- Real-time preview of AI-suggested changes
- Undo/redo functionality for AI modifications
- Batch operations for multiple elements

## Critical Paths

### Primary User Flows

1. **Content Creation Flow**

   ```
   User opens AI Chat → Describes desired content → AI generates blocks → User reviews/edits → Content applied to page
   ```

2. **Style Modification Flow**

   ```
   User selects elements → Describes style changes → AI applies modifications → User previews results → Changes saved
   ```

3. **Template Design Flow**
   ```
   User requests template → AI analyzes requirements → Generates template structure → User customizes → Template saved
   ```

## Installation

1. Add the Newfold Satis to your `composer.json`.

```bash
composer config repositories.newfold composer https://newfold-labs.github.io/satis
```

2. Require the `newfold-labs/wp-module-editor-chat` package.

```bash
composer require newfold-labs/wp-module-editor-chat
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- WordPress >= 6.0
- Gutenberg plugin (latest version recommended)

### GitHub Auth Token

Add GitHub Auth Token to `.npmrc` for private repo access.

1. Generate a GitHub personal access token if you haven't:  
   [GitHub Token Settings](https://github.com/settings/tokens).

2. Locate the `.npmrc` file in your project.

3. Add your GitHub token in `.npmrc`:

   ```
   @newfold-labs:registry=https://npm.pkg.github.com/
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN_HERE
   ```

4. Save the file.

## More on Newfold WordPress Modules

- <a href="https://github.com/newfold-labs/wp-module-loader#endurance-wordpress-modules">What are modules?</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#creating--registering-a-module">Creating/registering modules</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#installing-from-our-satis">Installing from our Satis</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#local-development">Local development notes</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#understanding-the-module-lifecycle">Understanding the module lifecycle</a>
