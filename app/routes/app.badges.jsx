import {
  Box,
  Card,
  Layout,
  Page,
  Text,
  BlockStack,
  Button,
  DataTable,
  Modal,
  TextField,
  FormLayout,
  EmptyState,
  Badge,
  Thumbnail
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useLoaderData, useActionData, useNavigation, useSubmit } from "react-router";
import { useState, useCallback } from "react";

// === BACKEND LOGIC (UNCHANGED) ===
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const badges = await prisma.badge.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });
  return { badges };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  const actionType = formData.get("actionType");
  
  if (actionType === "save") {
    const text = formData.get("text");
    const imageUrl = formData.get("imageUrl");
    const productIdsStr = formData.get("productIds") || "[]";
    const productIds = JSON.parse(productIdsStr);
    
    // Save to DB
    const badge = await prisma.badge.create({
      data: {
        shop: session.shop,
        text: text,
        imageUrl: imageUrl,
        isEnabled: true,
      },
    });

    // Sync to Metafields for selected products
    const metafieldsSetMutations = [];
    
    for (const gid of productIds) {
      metafieldsSetMutations.push(`
        {
          ownerId: "${gid}",
          namespace: "custom",
          key: "product_badge",
          type: "json",
          value: "${JSON.stringify({ text, imageUrl }).replace(/"/g, '\\"')}"
        }
      `);
    }

    if (metafieldsSetMutations.length > 0) {
      const mutation = `
        mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields {
              id
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      
      const variables = {
        metafields: productIds.map(gid => ({
          ownerId: gid,
          namespace: "custom",
          key: "product_badge",
          type: "json",
          value: JSON.stringify({ text, imageUrl, isEnabled: true })
        }))
      };

      const response = await admin.graphql(mutation, { variables });
      const responseJson = await response.json();
      if (responseJson.data?.metafieldsSet?.userErrors?.length > 0) {
        console.error("Metafield sync error", responseJson.data.metafieldsSet.userErrors);
      }
    }
    
    return { success: true, badge };
  } else if (actionType === "delete") {
     const id = formData.get("id");
     await prisma.badge.delete({ where: { id: parseInt(id) } });
     return { success: true };
  }

  return null;
};

// === FRONTEND UI (UPGRADED DESIGN) ===
export default function Badges() {
  const { badges } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isLoading = nav.state === "submitting" || nav.state === "loading";

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  
  const handleModalChange = useCallback(() => setIsModalOpen(!isModalOpen), [isModalOpen]);

  const handleSave = async () => {
    const selectedProductIds = await selectProducts();
    if (!selectedProductIds || selectedProductIds.length === 0) return;

    submit(
      { text, imageUrl, productIds: JSON.stringify(selectedProductIds.map(p => p.id)), actionType: "save" },
      { method: "post" }
    );
    setIsModalOpen(false);
    setText("");
    setImageUrl("");
  };

  const selectProducts = async () => {
    return new Promise((resolve) => {
        async function openPicker() {
          const selected = await shopify.resourcePicker({type: 'product', multiple: true});
          if (selected) {
             resolve(selected);
          } else {
             resolve([]);
          }
        }
        openPicker();
    });
  };

  const handleDelete = (id) => {
    submit({ id: id.toString(), actionType: "delete" }, { method: "post" });
  };

  // Upgraded Table Rows
  const rows = badges.map((badge) => [
    <Text variant="bodyMd" fontWeight="bold">#{badge.id}</Text>,
    badge.text ? <Badge tone="success">{badge.text}</Badge> : <Text tone="subdued">No Text</Text>,
    badge.imageUrl ? (
      <Thumbnail source={badge.imageUrl} alt="Badge Preview" size="small" />
    ) : (
      <Text tone="subdued">No Image</Text>
    ),
    new Date(badge.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
    <Button variant="plain" tone="critical" onClick={() => handleDelete(badge.id)} loading={isLoading}>
      Delete
    </Button>
  ]);

  return (
    <Page 
      subtitle="Create custom labels and boost your product sales."
    >
      <TitleBar title="Badges Dashboard">
        <button variant="primary" onClick={handleModalChange}>
          Create new badge
        </button>
      </TitleBar>

      <Layout>
        <Layout.Section>
          <Card padding="0">
            {badges.length === 0 ? (
              // Beautiful Empty State instead of plain text
              <EmptyState
                heading="Highlight products with custom badges"
                action={{
                  content: 'Create your first badge',
                  onAction: handleModalChange,
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Make your products stand out with "50% OFF", "Trending", or custom image stickers.</p>
              </EmptyState>
            ) : (
              // Clean Data Table
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Badge ID", "Label Text", "Image", "Created On", "Actions"]}
                rows={rows}
                hasZebraStriping
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={isModalOpen}
        onClose={handleModalChange}
        title="Create a new Product Badge"
        primaryAction={{
          content: 'Select Products & Save',
          onAction: handleSave,
          loading: isLoading
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: handleModalChange,
          },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <Text variant="headingMd" as="h2">Badge Details</Text>
            <TextField
              label="Badge Text"
              value={text}
              onChange={setText}
              autoComplete="off"
              placeholder="E.g., 50% OFF"
              helpText="This text will be displayed directly on your product image."
            />
            <TextField
              label="Custom Image URL (Optional)"
              value={imageUrl}
              onChange={setImageUrl}
              autoComplete="off"
              placeholder="https://example.com/badge.png"
              helpText="Use an image URL if you prefer a graphical sticker instead of text."
            />
            
            {/* Live Preview Section */}
            {(text || imageUrl) && (
               <Box paddingBlockStart="400">
                 <Text variant="headingSm" as="h3">Preview</Text>
                 <Box padding="200" background="bg-surface-secondary" borderRadius="100">
                   {imageUrl ? (
                     <Thumbnail source={imageUrl} alt="preview" />
                   ) : (
                     <Badge tone="success" size="large">{text}</Badge>
                   )}
                 </Box>
               </Box>
            )}
          </FormLayout>
        </Modal.Section>
      </Modal>
    </Page>
  );
}