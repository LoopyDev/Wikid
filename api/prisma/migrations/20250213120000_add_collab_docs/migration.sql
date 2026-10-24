-- CreateTable
CREATE TABLE "CollabDoc" (
    "documentName" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "materializedAt" TIMESTAMP(3),
    "materializeRequestedAt" TIMESTAMP(3),

    CONSTRAINT "CollabDoc_pkey" PRIMARY KEY ("documentName")
);
