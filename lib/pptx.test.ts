// Run: node --test lib/pptx.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"

import { downloadZip } from "client-zip"

const { readPptx } = await import("./pptx.ts")

const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
const sp = (ph: string, ...paras: string[]) =>
  `<p:sp><p:nvSpPr><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody>${paras
    .map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`)
    .join("")}</p:txBody></p:sp>`

test("reads slides in presentation order with titles, text and images", async () => {
  const files = {
    "ppt/presentation.xml": `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Target="slides/slide2.xml" Type="${REL}/slide" Id="rId3"/></Relationships>`,
    "ppt/slides/slide1.xml": `<p:sld>${sp('<p:ph type="title"/>', "Second")}${sp("", "Q3 &amp; Q4", "")}<p:pic><a:blip r:embed="rId5"/></p:pic></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="rId5" Type="${REL}/image" Target="../media/image1.png"/></Relationships>`,
    "ppt/slides/slide2.xml": `<p:sld>${sp('<p:ph type="ctrTitle"/>', "Hello")}${sp('<p:ph type="subTitle" idx="1"/>', "World")}</p:sld>`,
    "ppt/media/image1.png": "PNG",
  }
  const zip = await downloadZip(
    Object.entries(files).map(([name, input]) => ({ name, input }))
  ).arrayBuffer()

  const slides = await readPptx(new Uint8Array(zip))
  assert.deepEqual(
    slides.map((s) => [s.title, s.paragraphs]),
    [
      ["Hello", ["World"]],
      ["Second", ["Q3 & Q4"]],
    ]
  )
  assert.equal(slides[0].images.length, 0)
  const [img] = slides[1].images
  assert.equal(img.name, "image1.png")
  assert.equal(img.mime, "image/png")
  assert.equal(await (await img.blob()).text(), "PNG")
})
