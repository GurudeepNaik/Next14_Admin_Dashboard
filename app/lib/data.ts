import { sql } from '@vercel/postgres';
import {
  CustomerField,
  CustomersTable,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  User,
  Revenue,
} from './definitions';
import { formatCurrency, prisma } from './utils';
import { unstable_noStore as noStore } from 'next/cache';

export async function fetchRevenue() {
  noStore();
  try {
    console.log('Fetching revenue data...');
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const revenueData = await prisma.revenue.findMany();
    console.log('Data fetch completed after 8 seconds.');
    return revenueData;
  } catch (error) {
    console.error('Prisma Error:', error);
    throw new Error('Failed to fetch revenue data.');
  } finally {
    await prisma.$disconnect();
  }
}

export async function fetchLatestInvoices() {
  noStore();
  try {
    const latestInvoices = await prisma.invoice.findMany({
      select: {
        id: true,
        amount: true,
        status: true,
        date: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            imageUrl: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
      take: 5,
    });

    const formattedInvoices = latestInvoices.map((invoice) => ({
      name: invoice.customer.name,
      image_url: invoice.customer.imageUrl,
      email: invoice.customer.email,
      id: invoice.id,
      amount: formatCurrency(invoice.amount),
    }));

    return formattedInvoices;
  } catch (error) {
    console.error('Prisma Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  } finally {
    await prisma.$disconnect();
  }
}

export async function fetchCardData() {
  noStore();
  try {
    const [numberOfInvoices, numberOfCustomers, invoiceStatus] =
      await Promise.all([
        prisma.invoice.count(),
        prisma.customer.count(),
        prisma.invoice.groupBy({
          by: ['status'],
          _sum: {
            amount: true,
          },
          _count: true,
          where: {
            OR: [{ status: 'paid' }, { status: 'pending' }],
          },
        }),
      ]);
    const pending = invoiceStatus.find((each) => each.status === 'pending')
      ?._sum.amount;
    const paid = invoiceStatus.find((each) => each.status === 'paid')?._sum
      .amount;
    const totalPaidInvoices = formatCurrency(paid || 0);
    const totalPendingInvoices = formatCurrency(pending || 0);

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  } finally {
    await prisma.$disconnect();
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  noStore();
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    // const queryDate = new Date(query);
    // const isValidDate = !isNaN(queryDate.getTime());
    // console.log(queryDate.toDateString());
    const invoices = await prisma.invoice.findMany({
      select: {
        id: true,
        amount: true,
        date: true,
        status: true,
        customer: {
          select: {
            name: true,
            email: true,
            imageUrl: true,
          },
        },
      },
      where: {
        OR: [
          {
            customer: {
              name: {
                contains: typeof query === 'string' ? query : '',
                mode: 'insensitive',
              },
            },
          },
          {
            customer: {
              email: {
                contains: typeof query === 'string' ? query : '',
                mode: 'insensitive',
              },
            },
          },
          {
            amount: {
              equals: typeof query === 'number' ? parseFloat(query) : undefined,
            },
          },
          // isValidDate
          //   ? {
          //       date: {
          //         gte: new Date(queryDate.toDateString()),
          //         // lte: new Date(`${query}T23:59:59.999Z`).toISOString(),
          //       },
          //     }
          //   : {},
          query === 'pending' || query === 'paid'
            ? {
                status: {
                  equals: query,
                },
              }
            : {},
        ],
      },
      orderBy: {
        date: 'desc',
      },
      take: ITEMS_PER_PAGE,
      skip: offset,
    });

    return invoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }
}

export async function fetchInvoicesPages(query: string) {
  noStore();
  const numberQuery = Number(query);
  try {
    const count = await prisma.invoice.count({
      where: {
        OR: [
          { customer: { name: { contains: query, mode: 'insensitive' } } },
          { customer: { email: { contains: query, mode: 'insensitive' } } },
          isNaN(numberQuery) ? {} : { amount: { equals: Number(query) } },
          // { date: { contains: query } },
          query === 'pending' || query === 'paid'
            ? {
                status: {
                  equals: query,
                },
              }
            : {},
        ],
      },
    });

    const totalPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  }
}

export async function fetchInvoiceById(id: string) {
  noStore();
  try {
    const invoice = await prisma.invoice.findFirst({
      select: {
        id: true,
        customerId: true,
        amount: true,
        status: true,
        date: true,
        createdAt: true,
      },
      where: {
        id: id,
      },
    });
    if (invoice) {
      const { amount } = invoice;
      invoice.amount = amount / 100;
    }

    return invoice;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchCustomers() {
  noStore();
  try {
    return await prisma.customer.findMany({
      select: {
        id: true,
        name: true,
      },
      orderBy: {
        name: 'asc',
      },
    });
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch all customers.');
  }
}

export async function fetchFilteredCustomers(query: string) {
  noStore();
  try {
    interface FilteredCustomersType {
      id: number;
      name: string;
      email: string;
      image_url: string;
      total_invoices: number;
      total_pending: number;
      total_paid: number;
    }
    const FilteredCustomers: FilteredCustomersType[] = await prisma.$queryRaw`
    SELECT
      customers.id,
      customers.name,
      customers.email,
      customers.imageUrl,
      COUNT(invoices.id) AS total_invoices,
      SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
      SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
    FROM customers
    LEFT JOIN invoices ON customers.id = invoices.customer_id
    WHERE
      customers.name ILIKE ${`%${query}%`} OR
      customers.email ILIKE ${`%${query}%`}
    GROUP BY customers.id, customers.name, customers.email, customers.imageUrl
    ORDER BY customers.name ASC
  `;

    const customers = FilteredCustomers.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch customer table.');
  }
}

export async function getUser(email: string) {
  noStore();
  try {
    // const user = await sql`SELECT * FROM users WHERE email=${email}`;
    const user = await prisma.user.findMany({
      where: { email: email },
    });
    return user;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}
