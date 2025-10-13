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

### Run the module in dev mode

```bash
npm run start
```

### Development Commands

```bash
# Install dependencies
npm install

# Start development server
npm run start

# Build for production
npm run build

# Run linting
npm run lint:js
npm run lint:js:fix

# Run tests
npm run test

# Format code
npm run format
```

## Releases

To ensure a smooth and error-free release, follow these detailed instructions closely.

Run the `Newfold Prep Release` github action to automatically bump the version (either patch, minor or major version), and update build and language files all at once. It will create a PR with changed files for manual review. Using this workflow, we can skip all the manual steps below.

### Manual Initial Setup

1. Checkout a new branch for the release using the format `release/<new_version>`.

2. Run `npm install` to install necessary npm packages.

3. Execute `composer install` to install PHP dependencies.

### Manual Version Updates

It is essential to verify that the version has been appropriately incremented in both the PHP and JavaScript components. Specifically, ensure that:

1. PHP constant `NFD_AI_EDITOR_CHAT_VERSION` has been updated to the intended release version on line 18 of the file `/bootstrap.php`. This PHP constant dictates the expected location of build files for the module. For example:

```php
define( 'NFD_AI_EDITOR_CHAT_VERSION', '1.0.0' );
```

2. JavaScript release version aligns with the desired release by checking line 3 in the `package.json` file. For example:

```json
"version": "1.0.0",
```

### Manual Build

Manually prepare the release:

1. Run `npm run lint:js` to ensure JavaScript code quality.

2. Delete the old build files from the `/build` directory.

3. Execute `npm run build` to build the most recent set of build files.

4. Run `composer run i18n` to update language files.

5. Run `composer run clean` to ensure that PHP code standards are met.

Ensure that these files are committed to the repository, as they are essential components to be incorporated into the upcoming release.

### Final Manual Steps

1. Commit all changes and push them to the repository.

2. Create a Pull Request (PR) to the main branch for peer approval. Teammates can check out this branch to verify everything is in order.

3. After approval, merge the PR into the main branch.

### Create a Release on GitHub

1. Go to [New Release](https://github.com/newfold-labs/wp-module-editor-chat/releases/new).

2. Ensure the tag number matches the updated version.

3. Set the title as `Version <new_version>`.

4. Generate release notes and publish the release.

5. Confirm that `<new_version>` exists on both [GitHub Tags](https://github.com/newfold-labs/wp-module-editor-chat/tags) and [Satis](https://newfold-labs.github.io/satis/#editor-chat).

## Contributing

### Development Guidelines

1. Follow WordPress coding standards
2. Write comprehensive tests for new features
3. Document all API changes
4. Ensure accessibility compliance
5. Test across multiple browsers and devices

### Code Style

- Use ESLint for JavaScript linting
- Follow PSR-12 for PHP code
- Use Prettier for code formatting
- Write meaningful commit messages

## Support

For support and questions:

- **Documentation**: [Module Documentation](https://github.com/newfold-labs/wp-module-editor-chat/docs)
- **Issues**: [GitHub Issues](https://github.com/newfold-labs/wp-module-editor-chat/issues)
- **Discussions**: [GitHub Discussions](https://github.com/newfold-labs/wp-module-editor-chat/discussions)
- **Email**: support@newfold.com

## More on Newfold WordPress Modules

- <a href="https://github.com/newfold-labs/wp-module-loader#endurance-wordpress-modules">What are modules?</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#creating--registering-a-module">Creating/registering modules</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#installing-from-our-satis">Installing from our Satis</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#local-development">Local development notes</a>
- <a href="https://github.com/newfold-labs/wp-module-loader#understanding-the-module-lifecycle">Understanding the module lifecycle</a>
