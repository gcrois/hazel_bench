import puppeteer, { Page, ElementHandle, Browser } from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';
import { emulateKeyCombination } from './utils';

const RecorderConfig = {
    followNewTab: true,
    fps: 60,
    videoFrame: {
      width: 1024,
      height: 1024,
    },
    videoCrf: 18,
    videoCodec: 'libx264',
    videoPreset: 'ultrafast',
    videoBitrate: 1000,
    autopad: {
        color: 'black'
    },
    aspectRatio: '1:1',
};

function wait(time: number) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
} 

class Cell {
    private page: Page;
    private elementHandle: ElementHandle;
    readonly classes: string[];
    readonly ids: string[];

    constructor(page: Page, elementHandle: ElementHandle, classes: string[], ids: string[] = []) {
        this.page = page;
        this.elementHandle = elementHandle;
        this.classes = classes;
        this.ids = ids;
    }

    async getContent(): Promise<string | null> {
        return await this.page.evaluate(el => el.textContent, this.elementHandle);
    }

    async scroll() {
        await wait(100);
        await this.page.evaluate(el => el.children[0].scrollIntoView({"block": "center", "behavior": "smooth"}), this.elementHandle);
        await wait(1000);
    }

    async backspaceContent(n=1, delay=0) {
        const contentHandle = await this.elementHandle.$('.code-container .code-text');
        if (contentHandle) {
            await contentHandle.click();
            for (let i = 0; i < n; i++) {
                await contentHandle.press('Backspace');
                await setTimeout(() => {}, delay);
            }
        }
    }

    async clearContent() {
        const contentHandle = await this.elementHandle.$('.code-container .code-text');
        if (contentHandle) {
            await emulateKeyCombination(this.page, contentHandle, 'a', 'Control');
            await contentHandle.press('Backspace');
        }
    }

    async typeString(string: string, delay=0, waitForCompletion=false) {
        // select the code container
        const codeContainer = await this.elementHandle.$('.code-container .code-text');
        if (!codeContainer) throw new Error('Code container not found');
        await codeContainer.click();

        const lines = string.split('\n');
        for (let i = 0; i < lines.length; i++) {
            for (let j = 0; j < lines[i].length; j++) {
                await codeContainer.type(lines[i][j]);
                await wait(delay);
            }
            if (i !== lines.length - 1) {
                await this.page.keyboard.press('Enter');
            }
        }
    }
}

class HazelController {
    private browser: Browser | null = null;
    private recorder: PuppeteerScreenRecorder | null = null;
    page: Page | null = null;

    async launch(url: string, record=false) {
        this.browser = await puppeteer.launch({ headless: true });
        // set resolution
        this.page = await this.browser.pages().then(pages => pages[0]) || await this.browser.newPage();
        await this.page.setViewport({ width: 1024, height: 1024 });
        await this.page.goto(url);

        // wait for class "loading" to disappear
        await this.page?.waitForFunction(() => {
            const loading = document.querySelector('.loading');
            return !loading;
        });

        if (record) {
            this.recorder = new PuppeteerScreenRecorder(this.page, RecorderConfig);
            await this.recorder.start(`demo-${Date.now()}.mp4`);
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            await this.recorder?.stop();
        }
    }

    async selectMode(mode: string) {
        await this.page?.select('#editor-mode select', mode);
    
        // wait until id="main" has the class that matches the mode
        await this.page?.waitForFunction(
            (mode) => {
                const main = document.getElementById('main');
                return main && main.classList.contains(mode);
            },
            {},
            mode
        );
    }

    async getCells(): Promise<Cell[]> {
        const cells = await this.page?.$$('.cell');
        if (!cells) return [];

        return Promise.all(cells.map(async (elementHandle, index) => {
            let classes = await elementHandle.evaluate(el => el.children[0].className);
            let ids = [];
            // if we have class cell-item, also add all of the children classes
            if (classes.includes('cell-item')) {
                const childrenClasses = await elementHandle.evaluate(el => Array.from(el.children[0].children).map((child: Element) => child.className).join(' '));
                classes += ' ' + childrenClasses;
            }
            // retrieve all ids from deep descendants
            ids = await elementHandle.evaluate(el => Array.from(el.querySelectorAll('[id]')).map((el: Element) => el.id));
            return new Cell(this.page!, elementHandle, classes.split(' '), ids);
        }));
    }

    async waitForCompletion() {
        await this.page?.waitForFunction(() => {
            const testSummary = document.querySelector('.test-summary .test-percent');
            return testSummary && testSummary!.textContent?.includes('4.0');
        });
    }
}

// Usage example
(async () => {
    const controller = new HazelController();
    await controller.launch('http://localhost:8000', true);

    // Select "Exercises" mode
    await controller.selectMode('Exercises');

    // Get all cells
    const cells = await controller.getCells();

    // edit the first cell with id "YourImpl"
    const codeCell = cells.find(cell => cell.ids.includes('YourImpl'))!;
    await codeCell.scroll();
    
    console.log('Original content:', await codeCell.getContent());
    await codeCell.clearContent();
    await codeCell.typeString('let my_str = "this is automatically inserted content"\nin my_str ++ my_str', 100);
    console.log('New content:', await codeCell.getContent());

    // save screenshot
    await controller.page?.screenshot({ path: 'screenshot.png' });

    // Close browser
    await controller.close();
})();
