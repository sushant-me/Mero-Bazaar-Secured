import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { CreateListingDto } from './dto/create_listing.dto';
import { UpdateListingDto } from './dto/update_listing.dto';
import { SearchListingDto } from './dto/search_listing.dto';
import { buildListingFilter } from '../../search/builders/listings_filter.builder';
import { ListingCategory } from '@prisma/client';
import { assertVerifiedSeller } from '../../common/authz/seller-access';

@Injectable()
export class ListingsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateListingDto, userId: string) {
    // Generic publication path: it accepts any ListingCategory, so it must
    // enforce the same KYC gate as the per-category services. Without this,
    // POST /listings let any authenticated account publish without KYC.
    await assertVerifiedSeller(this.prisma, userId);

    return this.prisma.listing.create({
      data: {
        title: dto.title,
        description: dto.description,
        price: dto.price,
        userId,
        category: dto.category,
        images: dto.images,
        latitude: dto.latitude,
        longitude: dto.longitude,
      },
    });
  }

  findAll() {
    return this.prisma.listing.findMany({
      include: {
        vehicle: true,
        job: true,
        medical: true,
        trades: true,
        rental: true,
        agriculture: true,
        secondhand: true,
        foods: true,
        beauty: true,
      },
    });
  }

  async findOne(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        vehicle: true,
        job: true,
        medical: true,
        trades: true,
        rental: true,
        agriculture: true,
        secondhand: true,
        foods: true,
        beauty: true,
        reviews: true,
        user: {
          select: {
            name: true,
            image: true,
            phone: true,
            createdAt: true,
            vendorProfile: {
              select: { isVerified: true },
            },
            _count: {
              select: { listings: true },
            },
          },
        },
      },
    });

    if (!listing) return null;

    const sellerRatingAgg = await this.prisma.review.aggregate({
      where: { listing: { userId: listing.userId } },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return {
      ...listing,
      sellerRating: sellerRatingAgg._avg.rating ?? 0,
      sellerReviewCount: sellerRatingAgg._count.rating,
    };
  }

  async findAllMine(userId: string) {
    return this.prisma.listing.findMany({
      where: { userId },
      include: {
        vehicle: true,
        job: true,
        medical: true,
        trades: true,
        rental: true,
        agriculture: true,
        secondhand: true,
        foods: true,
        beauty: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  async update(id: string, dto: UpdateListingDto, userId: string) {
    return this.prisma.listing.update({
      where: { id, userId },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.description && { description: dto.description }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.images !== undefined && { images: dto.images }),
        ...(dto.latitude !== undefined && { latitude: dto.latitude }),
        ...(dto.longitude !== undefined && { longitude: dto.longitude }),
      },
    });
  }

  async remove(id: string, userId: string) {
    return this.prisma.listing.delete({
      where: { id, userId },
    });
  }

  async getMyStats(userId: string) {
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [totalProducts, productsThisMonth, productsLastMonth] =
      await Promise.all([
        this.prisma.listing.count({ where: { userId } }),
        this.prisma.listing.count({
          where: { userId, createdAt: { gte: startOfThisMonth } },
        }),
        this.prisma.listing.count({
          where: {
            userId,
            createdAt: { gte: startOfLastMonth, lt: startOfThisMonth },
          },
        }),
      ]);
    return { totalProducts, productsThisMonth, productsLastMonth };
  }

  async search(query: SearchListingDto) {
    const where = buildListingFilter(query);

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    return this.prisma.listing.findMany({
      where: {
        ...where,

        id: query.exclude ? { not: query.exclude } : undefined,
      },

      include: {
        vehicle: true,
        job: true,
        medical: true,
      },

      orderBy: {
        createdAt: 'desc',
      },

      take: limit,
      skip: (page - 1) * limit,
    });
  }

  async getRelated(category: ListingCategory, exclude: string, limit: number) {
    return this.prisma.listing.findMany({
      where: {
        category,
        id: exclude ? { not: exclude } : undefined,
      },
      include: {
        vehicle: true,
        job: true,
        medical: true,
        trades: true,
        rental: true,
        agriculture: true,
        secondhand: true,
        foods: true,
        beauty: true,
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
